// The controls of the actor's view, in its pane's head (#controls): the view's own tools -- Chat's "Latest", back to the
// latest turn from one picked; another view's, the nodes it makes (filters, switches) -- the switch between the views
// offered (those on the bar, and the one shown if it is another), and Minimize and Details. React's, in a box of its
// own in the head (display: contents, so they lay out as the head's own), drawn as the page draws (`drawControls`);
// what does not change stays as it is under the pointer.
import { useLayoutEffect, useRef } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { StrokeIcon } from "../../core/ui/Icon";
import { useActorChat } from "./actors";

export interface ViewChoice {
  id: string;
  name: string;
  description?: string;
  icon?: string;
}

export interface ControlsProps {
  /** the actor shown: Chat's own tools are of it */
  actor: string;
  /** Chat's own tools: "Latest", its turns having come; else none */
  chat: boolean;
  /** another view's tools, as it makes them (null: none) */
  tools: Node[] | null;
  /** the views on the switch, and the one shown */
  views: ViewChoice[];
  current: string;
  /** Details open */
  details: boolean;
  /** the chat can be minimized: its button */
  minimize: { title: string } | null;
  detailsTitle: string;
  icons: Record<string, string>;
  show(id: string): unknown;
  toggleDetails(): unknown;
  doMinimize(): unknown;
  /** back to the latest turn */
  latest(): unknown;
}

/** Nodes another view made, put in its box as they are -- made again at each of its draws, as they were. */
function Made({ nodes }: { nodes: Node[] }) {
  const box = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    box.current?.replaceChildren(...nodes);
  }, [nodes]);
  return <div ref={box} className="chat-tools" />;
}

function ChatTools({ actor, latest }: { actor: string; latest: () => unknown }) {
  const picked = useActorChat(actor).picked;
  if (picked === null) return null;
  return (
    <div className="chat-tools">
      <button type="button" title="Show the latest turn" onClick={() => latest()}>
        Latest
      </button>
    </div>
  );
}

export function Controls(p: ControlsProps) {
  return (
    <>
      {p.chat ? (
        <ChatTools key="chat" actor={p.actor} latest={p.latest} />
      ) : p.tools?.length ? (
        <Made key="made" nodes={p.tools} />
      ) : null}
      {p.views.length >= 2 ? (
        <div className="views" role="group" aria-label="View">
          {p.views.map((v) => (
            <button
              key={v.id}
              type="button"
              aria-pressed={v.id === p.current}
              title={v.description || v.name}
              aria-label={v.name}
              onClick={() => p.show(v.id)}
            >
              {v.icon ? <StrokeIcon d={v.icon} /> : null}
              <span className="lbl">{v.name}</span>
            </button>
          ))}
        </div>
      ) : null}
      <div className="side-btns">
        {p.minimize ? (
          <button
            type="button"
            className="details-btn"
            aria-label="Minimize the chat"
            title={p.minimize.title}
            onClick={() => p.doMinimize()}
          >
            <StrokeIcon d={p.icons.minimize} size={16} />
          </button>
        ) : null}
        <button
          type="button"
          className="details-btn"
          aria-expanded={p.details}
          aria-label="Details"
          title={p.detailsTitle}
          onClick={() => p.toggleDetails()}
        >
          <StrokeIcon d={p.icons.info} size={16} />
        </button>
      </div>
    </>
  );
}

const heads = new WeakMap<HTMLElement, { node: HTMLDivElement; root: Root }>();

/** The controls drawn now as `props` say, in their box in `controls` (a pane's head: each its own): put back there if
 * the page put something else in its place (a shell's controls) since. */
export function drawControls(controls: HTMLElement, props: ControlsProps): void {
  let head = heads.get(controls);
  if (!head) {
    const node = document.createElement("div");
    node.style.display = "contents";
    head = { node, root: createRoot(node) };
    heads.set(controls, head);
  }
  const { node, root } = head;
  if (controls.firstChild !== node || controls.childNodes.length !== 1) controls.replaceChildren(node);
  flushSync(() => root.render(<Controls {...props} />));
}
