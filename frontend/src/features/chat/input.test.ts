// The text box a view of the reader's own builds its message box around (input.ts's pageBox, ctx.input): the actor's draft
// in it, Enter sending it, held by another process off; the page's other boxes React's (ownBox); a send's words put in it.
import { fireEvent } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { keepDraft } from "./drafts";
import { boxedFor, ownBox, pageBox } from "./input";

let sent: string[];
const box = (actor: string, held = "", attrs?: Record<string, string>) =>
  pageBox({ actor, held, send: (t) => sent.push(t), fit: () => {}, say: () => {} }, attrs);

beforeEach(() => {
  sessionStorage.clear();
  sent = [];
});

describe("a view's own text box", () => {
  it("starts with the actor's draft, sends on Enter, not Shift+Enter, and is not React's", () => {
    keepDraft("g\0a", "half");
    const b = box("g\0a", "", { placeholder: "Say it", id: "mine" });
    expect([b.id, b.dataset.draft, b.value, b.placeholder]).toEqual(["composer-text", "g\0a", "half", "Say it"]);
    expect(b.getAttribute("enterkeyhint")).toBe("send");
    fireEvent.keyDown(b, { key: "Enter", shiftKey: true });
    fireEvent.keyDown(b, { key: "Enter" });
    expect(sent).toEqual(["half"]);
    expect(ownBox(b)).toBe(false);
    const react = Object.assign(document.createElement("textarea"), { id: "composer-text" });
    expect(ownBox(react)).toBe(true);
  });

  it("is off while another process holds the session, and shows the words a send puts back", () => {
    const b = box("g\0b", "Open in another process.");
    expect([b.disabled, b.placeholder]).toEqual([true, "Open in another process"]);
    document.body.append(b);
    boxedFor("g\0b", () => {})("put back");
    boxedFor("g\0c", () => {})("not its");
    expect(b.value).toBe("put back");
    b.remove();
  });
});
