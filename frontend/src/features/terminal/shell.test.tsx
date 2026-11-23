// A shell's pane (shell.tsx): its card -- the terminal's node in its frame, the same card from draw to draw -- and its
// Terminate button in the head; and the pane closed once the shell ends (shownGone).
import { act, fireEvent } from "@testing-library/react";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { setTermPage, type TermPage, type TermPane } from "./link";
import { shellCard, shownGone } from "./shell";

const w = window as unknown as Record<string, unknown>;
beforeAll(() => {
  // xterm.js as the page loads it, standing in; no stream (a snapshot's terminal listens to none)
  w.Terminal = class {
    cols = 80;
    rows = 24;
    options = {};
    open() {}
    focus() {}
    reset() {}
    write() {}
    dispose() {}
    loadAddon() {}
    onData() {}
    onResize() {}
  };
  w.FitAddon = {
    FitAddon: class {
      fit() {}
      proposeDimensions() {}
    },
  };
  w.ResizeObserver ??= class {
    observe() {}
    disconnect() {}
  };
  w.AG_SNAPSHOT = {};
  vi.stubGlobal("requestAnimationFrame", (f: () => void) => setTimeout(f, 0));
});
afterAll(() => {
  delete w.Terminal;
  delete w.FitAddon;
  delete w.AG_SNAPSHOT;
  vi.unstubAllGlobals();
});

const pane = (c: string): TermPane => ({ c, controls: document.createElement("div") });
function page(over: Partial<TermPage> = {}): TermPage & { calls: string[] } {
  const calls: string[] = [];
  const say = (what: string) => () => {
    calls.push(what);
  };
  return {
    calls,
    snapshot: false,
    icons: { power: "M1 1", terminal: "M2 2" },
    home: () => null,
    addView: say("view"),
    hasChat: () => true,
    readOnlyWhy: () => "",
    others: () => [],
    closePane: (p) => calls.push(`close ${p.c}`),
    closeHere: say("close here"),
    selected: () => null,
    clearSelected: say("cleared"),
    shownGroups: () => [],
    firstAgent: (g) => g.agents[0],
    select: async (g, c) => {
      calls.push(`select ${g} ${c}`);
    },
    savePanes: say("saved"),
    connect: say("connected"),
    render: say("drawn"),
    closeShell: async (id) => {
      calls.push(`end ${id}`);
    },
    ...over,
  };
}

describe("a shell's pane", () => {
  it("draws its terminal in its card, the same card from draw to draw, and its Terminate in the head", async () => {
    const link = page();
    setTermPage(link);
    const p = pane("shell:1");
    let card!: HTMLElement;
    act(() => {
      card = shellCard(p, "shell:1");
    });
    expect(card.matches("section.chat[aria-label='Terminal'][data-sig]")).toBe(true);
    expect(card.querySelector(":scope > .chat-frame.xterm-frame > .xterm-host")).not.toBeNull();
    const end = p.controls.querySelector<HTMLButtonElement>("button.terminate[data-shell='shell:1']")!;
    expect(end.getAttribute("aria-label")).toBe("Terminate shell");
    expect(end.textContent).toBe("Terminate");
    act(() => {
      expect(shellCard(p, "shell:1")).toBe(card);
    });
    expect(p.controls.querySelector("button.terminate")).toBe(end); // kept under the pointer
    await act(async () => {
      fireEvent.click(end);
    });
    expect(link.calls).toContain("end shell:1");
    expect(end.disabled).toBe(false); // back once it ended
  });

  it("closes the panes showing a shell that ended; the page's own shows the next pane's actor, or another", () => {
    const beside = pane("shell:2");
    const next = pane("c2");
    let link = page({ others: () => [beside, next], selected: () => ["g", "shell:2"] });
    setTermPage(link);
    shownGone("shell:2");
    expect(link.calls).toEqual(["close shell:2", "close here"]);
    const groups = [{ name: "g", agents: [{ channel: "c1" }] }];
    link = page({ selected: () => ["g", "shell:2"], shownGroups: () => groups });
    setTermPage(link);
    shownGone("shell:2");
    expect(link.calls).toEqual(["select g c1"]);
    link = page({ selected: () => ["g", "shell:2"] });
    setTermPage(link);
    shownGone("shell:2");
    expect(link.calls).toEqual(["cleared", "saved", "connected", "drawn"]);
    link = page({ selected: () => ["g", "c1"] });
    setTermPage(link);
    shownGone("shell:9"); // another's: nothing
    expect(link.calls).toEqual([]);
  });
});
