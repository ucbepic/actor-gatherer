// The list's head and its own buttons, and the bar for the actors selected, in React: what they draw, and what a press,
// or an item of their menus, calls of the page.
import { fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HeadParts } from "./Head";
import type { ListHost } from "./host";
import { FullButton, ListButtons } from "./ListButtons";
import { PickBar, type PickBarHost } from "./PickBar";

const span = (cls: string) => Object.assign(document.createElement("span"), { className: cls });
afterEach(() => document.body.replaceChildren());

describe("the list's head", () => {
  const host = (more: Partial<ListHost> = {}) =>
    ({
      snapshot: false,
      outsideCan: () => false,
      outsideDrop: vi.fn(),
      newGroup: vi.fn(),
      aloneNew: () => ({ why: "", off: false, busy: false, open: false }),
      aloneNewPress: vi.fn(),
      listButtons: () => ({ mode: "list", hidden: false, pane: false }),
      setListMode: vi.fn(),
      setListHidden: vi.fn(),
      iconPath: () => "M2 2h12",
      crew: () => null,
      ...more,
    }) as unknown as ListHost;

  it("draws its title, the drop outside every group, a new group, an actor on its own and its own buttons", () => {
    const h = host();
    const { container } = render(<HeadParts host={h} merged={true} />);
    expect([...container.children].map((n) => n.tagName.toLowerCase() + "." + n.className)).toEqual([
      "h2.",
      "div.outside-drop",
      "button.gf-new",
      "button.alone-new",
      "span.list-btns",
    ]);
    fireEvent.click(container.querySelector(".gf-new")!);
    expect(h.newGroup).toHaveBeenCalled();
    const alone = container.querySelector<HTMLButtonElement>(".alone-new")!;
    expect(alone.getAttribute("data-pop")).toBe("self:new");
    fireEvent.click(alone);
    expect(h.aloneNewPress).toHaveBeenCalledWith(alone);
    fireEvent.click(container.querySelector(".lb-fold")!);
    expect(h.setListMode).toHaveBeenCalledWith("folded");
    fireEvent.click(container.querySelector(".lb-hide")!);
    expect(h.setListHidden).toHaveBeenCalledWith(true);
  });
  it("in a group of its own's home and in a snapshot, neither the drop nor the new buttons", () => {
    const { container } = render(<HeadParts host={host({ snapshot: true, aloneNew: () => null })} merged={false} />);
    expect([...container.children].map((n) => n.tagName.toLowerCase())).toEqual(["h2", "span"]);
  });
  it("an actor on its own that can't start says why, pressed or not", () => {
    const h = host({ aloneNew: () => ({ why: "Make a group first", off: false, busy: false, open: false }) });
    const { container } = render(<HeadParts host={h} merged={true} />);
    const alone = container.querySelector<HTMLButtonElement>(".alone-new")!;
    expect(alone.disabled).toBe(true);
    expect(alone.title).toBe("Make a group first");
  });
  it("its buttons say the list's shape: folded, hidden; over the whole page, none; the top bar's, full or not", () => {
    const h = host();
    const { container, rerender } = render(
      <ListButtons info={{ mode: "folded", hidden: true, pane: false }} host={h} />,
    );
    expect(container.querySelector(".lb-fold")!.getAttribute("aria-label")).toBe("Open the list");
    expect(container.querySelector(".lb-hide")!.getAttribute("aria-pressed")).toBe("true");
    rerender(<ListButtons info={{ mode: "full", hidden: false, pane: false }} host={h} />);
    expect(container.children).toHaveLength(0);
    const set = vi.fn();
    rerender(<FullButton full={true} set={set} />);
    fireEvent.click(container.querySelector(".lb-full")!);
    expect(set).toHaveBeenCalledWith(false);
  });
});

describe("the bar for the actors selected", () => {
  const host = (run = vi.fn()): PickBarHost & { run: typeof run } => ({
    run,
    icon: (name) => span(`icon ${name}`),
    saveIcon: () => span("bookmark"),
    closeIcon: () => span("x"),
    moveMenu: () => ({
      head: "Move 2 actors to",
      items: [
        { mark: span("top-mark"), text: "Top of g", run },
        { icon: "folder", text: "Work", depth: 1, run },
      ],
    }),
    save: vi.fn(),
    close: vi.fn(),
    clear: vi.fn(),
  });
  it("says how many, and saves, closes and clears them", () => {
    const h = host();
    const { container } = render(<PickBar m={{ n: 2, allSaved: true, group: "g" }} host={h} />);
    expect(container.querySelector(".n")!.textContent).toBe("2 selected");
    const [, save, close, clear] = [...container.querySelectorAll("button")];
    expect(save.textContent).toBe("Unsave");
    fireEvent.click(save);
    expect(h.save).toHaveBeenCalledWith(false);
    fireEvent.click(close);
    expect(h.close).toHaveBeenCalled();
    expect(clear.getAttribute("aria-label")).toBe("Clear the selection");
    fireEvent.click(clear);
    expect(h.clear).toHaveBeenCalled();
  });
  it("moves them from a menu of Radix's: the top, each folder set in by its depth; an item chosen runs", () => {
    const h = host();
    const { container } = render(<PickBar m={{ n: 2, allSaved: false, group: "g" }} host={h} />);
    const move = container.querySelector<HTMLButtonElement>('.pb[data-pop="picks:move"]')!;
    expect(move.title).toBe("Move to a folder in g");
    expect(move.getAttribute("aria-haspopup")).toBe("menu");
    fireEvent.keyDown(move, { key: "Enter" });
    const menu = document.querySelector(".row-menu[role=menu]")!;
    expect(menu.getAttribute("aria-label")).toBe("Move 2 actors to");
    const items = [...menu.querySelectorAll<HTMLElement>("[role=menuitem]")];
    expect(items.map((i) => i.querySelector(".nm")!.textContent)).toEqual(["Top of g", "Work"]);
    expect(items[1].style.paddingLeft).toBe("24px");
    fireEvent.click(items[1]);
    expect(h.run).toHaveBeenCalledWith(move);
    expect(document.querySelector(".row-menu[role=menu]")).toBeNull();
  });
});
