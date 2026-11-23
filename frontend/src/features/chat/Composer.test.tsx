// The Chat view's message box (Composer.tsx): what is typed kept as the actor's draft as it is typed, and what the page
// does to the draft shown at once; Enter sends, Shift+Enter does not; held by another process, off. The box the same
// node from draw to draw.
import { act, fireEvent, render } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { ComposerForm, ownBox, type ComposerProps } from "./Composer";
import { drafts, keepDraft } from "./drafts";

let sent: string[];
const props = (actor: string, held = false): ComposerProps => ({
  actor,
  held,
  send: (t) => sent.push(t),
  fit: () => {},
  say: () => {},
});
/** The box drawn in its form, and drawn again as `again` says. */
function drawn(actor: string, held = false) {
  const r = render(<ComposerForm {...props(actor, held)} />);
  return {
    form: r.container.firstElementChild as HTMLFormElement,
    again: (a = actor, h = held) => r.rerender(<ComposerForm {...props(a, h)} />),
  };
}

beforeEach(() => {
  sessionStorage.clear();
  sent = [];
});

describe("the message box", () => {
  it("keeps what is typed as the actor's draft, and shows the draft as the page changes it", () => {
    const { form, again } = drawn("g\0a");
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
    again();
    expect(form.querySelector("textarea")).toBe(box); // the same node, drawn again
  });

  it("sends on Enter, not on Shift+Enter, and by its form", () => {
    act(() => keepDraft("g\0b", "go"));
    const { form } = drawn("g\0b");
    const box = form.querySelector("textarea")!;
    fireEvent.keyDown(box, { key: "Enter", shiftKey: true });
    expect(sent).toEqual([]);
    fireEvent.keyDown(box, { key: "Enter" });
    fireEvent.submit(form);
    expect(sent).toEqual(["go", "go"]);
  });

  it("is off while another process holds the session", () => {
    const { form, again } = drawn("g\0c", true);
    const box = form.querySelector("textarea")!;
    expect(box.disabled).toBe(true);
    expect(box.placeholder).toBe("Open in another process");
    again("g\0c", false);
    expect(box.disabled).toBe(false);
  });
});
