// The page's drop-downs and boxes hung from a button (Pops.tsx): a menu's choices, its first in focus, a choice run with
// the button it hung from; a box -- the page's own form -- put in, its first box in focus; Esc closing either, the page
// told how; one at a time.
import { act, fireEvent, screen } from "@testing-library/react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { popShown, showPop, startPops, type Pop } from "./Pops";

const closed: [string, string][] = [];
let button: HTMLButtonElement;

beforeAll(() => {
  // what Radix's pop-ups need of a browser that jsdom lacks
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  startPops({
    icon: () => document.createElement("i"),
    closed: (pop, how) => closed.push([pop.key, how]),
  });
});
beforeEach(() => {
  act(() => showPop(null));
  closed.length = 0;
  document.querySelector("button[data-pop]")?.remove();
  button = Object.assign(document.createElement("button"), { textContent: "+" });
  button.dataset.pop = "start:g";
  document.body.append(button);
});

describe("a menu hung from a button", () => {
  it("lists its choices under its heading, the first in focus; a choice runs with its button, the menu closed", () => {
    const ran: HTMLElement[] = [];
    const pop: Pop = {
      key: "start:g",
      anchor: button,
      menu: {
        head: "New in g",
        sub: "~/work",
        items: [
          { text: "Claude Code", run: (b) => ran.push(b) },
          { sep: true, text: "", run: () => {} },
          { text: "Terminal", note: "in ~/work", run: () => {} },
        ],
      },
    };
    act(() => showPop(pop));
    const menu = screen.getByRole("menu", { name: "New in g" });
    expect(menu.className).toBe("br-menu row-menu");
    expect(menu.querySelector(".hd")!.textContent).toBe("New in g~/work");
    expect(screen.getAllByRole("menuitem").map((n) => n.textContent)).toEqual(["Claude Code", "Terminalin ~/work"]);
    expect(menu.querySelector("[role=separator].sep")).not.toBeNull();
    act(() => fireEvent.focus(menu));
    expect(document.activeElement).toBe(screen.getByRole("menuitem", { name: "Claude Code" }));
    act(() => fireEvent.click(screen.getByRole("menuitem", { name: "Claude Code" })));
    expect(ran).toEqual([button]);
    expect(popShown()).toBeNull();
    expect(screen.queryByRole("menu")).toBeNull();
    expect(closed).toEqual([["start:g", "chosen"]]);
  });

  it("closes on Esc, the page told so", () => {
    act(() =>
      showPop({ key: "start:g", anchor: button, menu: { head: "Run on", items: [{ text: "Codex", run: () => {} }] } }),
    );
    act(() => fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" }));
    expect(screen.queryByRole("menu")).toBeNull();
    expect(closed).toEqual([["start:g", "esc"]]);
  });
});

describe("a box hung from a button", () => {
  it("holds the page's form, its first box in focus at its end; Esc closes it", () => {
    const box = document.createElement("div");
    box.className = "dw-menu";
    box.setAttribute("role", "dialog");
    box.setAttribute("aria-label", "New actor on its own");
    const input = Object.assign(document.createElement("input"), { value: "~/work" });
    box.append(input);
    act(() => showPop({ key: "start:g", anchor: button, box }));
    expect(screen.getByRole("dialog", { name: "New actor on its own" })).toBe(box);
    expect(box.isConnected).toBe(true);
    expect(box.style.position).toBe("relative"); // laid out in the pop-up, not fixed where the page put it
    expect(document.activeElement).toBe(input);
    expect(input.selectionStart).toBe(6);
    act(() => fireEvent.keyDown(input, { key: "Escape" }));
    expect(box.isConnected).toBe(false);
    expect(closed).toEqual([["start:g", "esc"]]);
  });

  it("is one at a time: another shown in its place", () => {
    const one = document.createElement("div"),
      two = document.createElement("div");
    act(() => showPop({ key: "a", anchor: button, box: one }));
    act(() => showPop({ key: "b", anchor: button, box: two }));
    expect(one.isConnected).toBe(false);
    expect(two.isConnected).toBe(true);
    expect(popShown()!.key).toBe("b");
  });
});
