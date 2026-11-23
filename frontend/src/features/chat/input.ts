// The text box a view of the reader's own builds its message box around (a view's `composer`, ctx.input): a node it
// puts where it likes, so built here, outside React -- Enter sends it, Shift+Enter starts a new line, it starts with the
// actor's draft and what is typed in it is kept as the draft (the page's input listener, features/page/data.js), a line
// high and growing with the lines typed. An image pasted or dropped in is saved in the home (/api/upload) and its path
// typed in the message, for the agent to read. Every other message box is React's (Composer.tsx), which shows the
// draft as it is kept.
import { post } from "../../core/api/client";
import { drafts, keepDraft } from "./drafts";

/** The boxes built here: what the page keeps and fits as they are typed in. */
const pageBoxes = new WeakSet<HTMLTextAreaElement>();

/** Whether `n` is a message box of React's (Composer.tsx), not one built here: the page's draws do not wait while it is
 * typed in, and its draft is kept as it is typed. */
export const ownBox = (n: EventTarget | null): boolean =>
  n instanceof HTMLTextAreaElement && n.id === "composer-text" && !pageBoxes.has(n);

/** The boxes built here for `actor` showing `text` (a send emptying them, a failed one putting the words back). */
export const boxedFor =
  (actor: string, fit: (box: HTMLTextAreaElement) => void) =>
  (text: string): void => {
    for (const box of document.querySelectorAll<HTMLTextAreaElement>("textarea#composer-text"))
      if (box.dataset.draft === actor && pageBoxes.has(box)) {
        box.value = text;
        fit(box);
      }
  };

export interface BoxOf {
  actor: string;
  /** why another process holds the session ("": none) */
  held: string;
  send(text: string): unknown;
  fit(box: HTMLTextAreaElement): void;
  say(text: string): void;
}

/** The box, its attributes `attrs` over the page's own. */
export function pageBox(
  { actor, held, send, fit, say }: BoxOf,
  attrs: Record<string, string> = {},
): HTMLTextAreaElement {
  const box = document.createElement("textarea");
  const all: Record<string, string> = {
    rows: "1",
    placeholder: "Message the actor",
    "aria-label": "Message the actor",
    title: "Enter sends · Shift+Enter for a new line",
    enterkeyhint: "send",
    ...attrs,
    id: "composer-text",
    "data-draft": actor,
    ...(held ? { disabled: "", placeholder: "Open in another process" } : {}),
  };
  for (const [k, v] of Object.entries(all)) box.setAttribute(k, v);
  pageBoxes.add(box);
  box.value = drafts()[actor] || "";
  if (box.value) requestAnimationFrame(() => box.isConnected && fit(box)); // fitted once drawn into the page
  box.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter" && !ev.shiftKey && !ev.isComposing) {
      ev.preventDefault();
      send(box.value);
    }
  });
  const attach = (ev: Event, list: FileList | null | undefined) => {
    const images = [...(list || [])].filter((f) => f.type && f.type.startsWith("image/"));
    if (!images.length) return;
    ev.preventDefault();
    for (const f of images) {
      const reader = new FileReader();
      reader.onload = async () => {
        try {
          const { path } = await post<{ path: string }>("/api/upload", {
            type: f.type,
            data: String(reader.result).split(",")[1],
          });
          const at = box.selectionStart ?? box.value.length,
            tag = `[Image: ${path}] `;
          box.value = box.value.slice(0, at) + tag + box.value.slice(at);
          box.selectionStart = box.selectionEnd = at + tag.length;
          fit(box);
          keepDraft(actor, box.value);
        } catch (e) {
          say(`Image not attached: ${(e as Error).message}`);
        }
      };
      reader.readAsDataURL(f);
    }
  };
  box.addEventListener("paste", (ev) => attach(ev, ev.clipboardData && ev.clipboardData.files));
  box.addEventListener("dragover", (ev) => {
    if (ev.dataTransfer && [...ev.dataTransfer.types].includes("Files")) ev.preventDefault();
  });
  box.addEventListener("drop", (ev) => attach(ev, ev.dataTransfer && ev.dataTransfer.files));
  return box;
}
