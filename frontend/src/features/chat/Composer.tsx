// The Chat view's message box: what is typed is the actor's draft (drafts.ts), the box showing it as it is kept -- so
// what the page does to it (a send emptying it, a failed one putting it back, an Esc's take-back put in it) shows as it
// happens, and the page's draws never touch it. Enter sends it, Shift+Enter starts a new line; a line high, growing with
// the lines typed (the page's fitBox). An image pasted or dropped in is saved in the home (/api/upload) and its path
// typed in the message, for the agent to read. Each actor's box a node of its own (`drawComposer`), the same from draw
// to draw, as the frame (mount.tsx): the reader typing in it keeps the focus and the caret through every draw.
import { useLayoutEffect, useRef, type ClipboardEvent, type DragEvent } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { post } from "../../core/api/client";
import { keepDraft, useDrafts } from "./drafts";

export interface ComposerProps {
  /** the actor's key: its draft's */
  actor: string;
  /** another process has its session open: nothing sent from here */
  held: boolean;
  /** what is typed, sent (the page's: chat.js's chatSend) */
  send: (text: string) => unknown;
  /** the box as tall as what is typed in it (the page's fitBox) */
  fit: (box: HTMLTextAreaElement) => void;
  /** a word on the page's state line: what went wrong */
  say: (text: string) => void;
}

/** An image saved in the home for the agent to read: its path. */
async function upload(f: File): Promise<string> {
  const data = await new Promise<string>((done, fail) => {
    const reader = new FileReader();
    reader.onload = () => done(String(reader.result).split(",")[1]);
    reader.onerror = () => fail(reader.error);
    reader.readAsDataURL(f);
  });
  return (await post<{ path: string }>("/api/upload", { type: f.type, data })).path;
}

export function Composer({ actor, held, send, fit, say }: ComposerProps) {
  const value = useDrafts((s) => s.all[actor] ?? "");
  const box = useRef<HTMLTextAreaElement>(null),
    caret = useRef<number | null>(null);
  useLayoutEffect(() => {
    const b = box.current;
    if (!b) return;
    if (caret.current !== null) b.selectionStart = b.selectionEnd = caret.current;
    caret.current = null;
    if (b.isConnected) fit(b);
    else requestAnimationFrame(() => b.isConnected && fit(b)); // fitted once drawn into the page
  }, [value, fit]);
  const attach = (ev: ClipboardEvent | DragEvent, list: FileList | null | undefined) => {
    const images = [...(list || [])].filter((f) => f.type && f.type.startsWith("image/"));
    if (!images.length) return;
    ev.preventDefault();
    for (const f of images)
      upload(f).then(
        (path) => {
          const now = useDrafts.getState().all[actor] ?? "",
            at = box.current?.selectionStart ?? now.length,
            tag = `[Image: ${path}] `;
          caret.current = at + tag.length;
          keepDraft(actor, now.slice(0, at) + tag + now.slice(at));
        },
        (e: Error) => say(`Image not attached: ${e.message}`),
      );
  };
  return (
    <textarea
      ref={box}
      rows={1}
      placeholder={held ? "Open in another process" : "Message the actor"}
      aria-label="Message the actor"
      title="Enter sends · Shift+Enter for a new line"
      enterKeyHint="send"
      id="composer-text"
      data-draft={actor}
      disabled={held}
      value={value}
      onChange={(ev) => keepDraft(actor, ev.currentTarget.value)}
      onKeyDown={(ev) => {
        if (ev.key === "Enter" && !ev.shiftKey && !ev.nativeEvent.isComposing) {
          ev.preventDefault();
          send(ev.currentTarget.value);
        }
      }}
      onPaste={(ev) => attach(ev, ev.clipboardData?.files)}
      onDragOver={(ev) => {
        if (ev.dataTransfer && [...ev.dataTransfer.types].includes("Files")) ev.preventDefault();
      }}
      onDrop={(ev) => attach(ev, ev.dataTransfer?.files)}
    />
  );
}

/** The boxes kept, by actor, as many as the frames (mount.tsx's KEPT_TALKS); an older one off the page let go of. */
const KEPT = 12;
const boxes = new Map<string, { node: HTMLFormElement; root: Root; send: (text: string) => unknown }>();

/** The actor's message box, in its form (.composer), drawn as `props` say: its node, for the page to put where it goes. */
export function drawComposer(props: ComposerProps): HTMLFormElement {
  let kept = boxes.get(props.actor);
  if (kept) boxes.delete(props.actor);
  else {
    const node = document.createElement("form");
    node.className = "composer";
    const made = { node, root: createRoot(node), send: props.send };
    node.addEventListener("submit", (ev) => {
      ev.preventDefault();
      made.send(node.querySelector("textarea")?.value ?? "");
    });
    kept = made;
  }
  kept.send = props.send;
  boxes.set(props.actor, kept);
  for (const [k, b] of boxes) {
    if (boxes.size <= KEPT) break;
    if (k === props.actor || b.node.isConnected) continue;
    b.root.unmount();
    boxes.delete(k);
  }
  const box = kept;
  flushSync(() => box.root.render(<Composer {...props} />));
  return box.node;
}

/** Whether `n` is a box drawn here: the page's draws do not wait while it is typed in. */
export const ownBox = (n: EventTarget | null): boolean =>
  n instanceof HTMLTextAreaElement && [...boxes.values()].some((b) => b.node.contains(n));
