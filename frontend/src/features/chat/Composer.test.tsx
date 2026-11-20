// The Chat view's message box (Composer.tsx): what is typed kept as the actor's draft as it is typed, and what the page
// does to the draft shown at once; Enter sends, Shift+Enter does not; held by another process, off. Each actor's box the
// same node from draw to draw.
import { act, fireEvent } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { drawComposer, ownBox } from "./Composer";
import { drafts, keepDraft } from "./drafts";

let sent: string[];
const draw = (actor: string, held = false) =>
  drawComposer({ actor, held, send: (t) => sent.push(t), fit: () => {}, say: () => {} });

beforeEach(() => {
  sessionStorage.clear();
  sent = [];
});

describe("the message box", () => {
  it("keeps what is typed as the actor's draft, and shows the draft as the page changes it", () => {
    const form = draw("g\0a");
    document.body.append(form);
    const box = form.querySelector("textarea")!;
    expect(box.id).toBe("composer-text");
    expect(box.dataset.draft).toBe("g\0a");
    expect(ownBox(box)).toBe(true);
    act(() => {
      fireEvent.change(box, { target: { value: "hello" } });
    });
    expect(drafts()["g\0a"]).toBe("hello");
    act(() => keepDraft("g\0a", "")); // sent: emptied
    expect(box.value).toBe("");
    act(() => keepDraft("g\0a", "put back"));
    expect(box.value).toBe("put back");
    expect(draw("g\0a")).toBe(form); // the same node, drawn again
    form.remove();
  });

  it("sends on Enter, not on Shift+Enter, and by its form", () => {
    act(() => keepDraft("g\0b", "go"));
    const form = draw("g\0b");
    const box = form.querySelector("textarea")!;
    fireEvent.keyDown(box, { key: "Enter", shiftKey: true });
    expect(sent).toEqual([]);
    fireEvent.keyDown(box, { key: "Enter" });
    fireEvent.submit(form);
    expect(sent).toEqual(["go", "go"]);
  });

  it("is off while another process holds the session", () => {
    const box = draw("g\0c", true).querySelector("textarea")!;
    expect(box.disabled).toBe(true);
    expect(box.placeholder).toBe("Open in another process");
    expect(draw("g\0c").querySelector("textarea")!.disabled).toBe(false);
  });
});
