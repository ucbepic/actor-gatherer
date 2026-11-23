// The start boxes (StartBoxes.tsx) in their pop-up: the directory to start in, the folders its group's actors work in a
// click away, a harness's button starting it there; nothing typed, asked; a start that fails, why, in the box.
import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
vi.hoisted(() => {
  globalThis.matchMedia ??= (() => ({ matches: false, addEventListener() {} })) as unknown as typeof matchMedia;
});
import { setLayoutPage, type LayoutPage } from "./link";
import { closePop, openPop, popClosed } from "./popups";
import { startPops } from "./Pops";
import { railNewBox } from "./StartBoxes";
import type { Gatherer, PageState } from "./types";

const g: Gatherer = {
  name: "g",
  agents: [
    { channel: "a", cwd: "/h/one", last: 2 },
    { channel: "b", cwd: "/h/two", last: 1 },
  ],
};
const state: PageState = {
  home: { gatherers: [g], harnesses: ["h1", "h2"], home_dir: "/h", cwd: "/h/dash" },
  selected: null,
  starting: null,
  adding: null,
};
const posted: [string, unknown][] = [];
let button: HTMLButtonElement;

beforeAll(() => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  setLayoutPage({
    page: {
      state,
      panes: { here: null, others: [], apps: [], checked: false, top: null },
      SNAPSHOT: null,
      MAX_PANES: 4,
    },
    helpers: { harnessBadge: () => document.createElement("i"), harnessName: (h: string) => `Harness ${h}` },
    list: { titleOf: (x: Gatherer) => x.name, renderAgents: () => {} },
    groupMoves: { ALONE_NEW: "\u0003alone", everyActor: () => ({ agents: g.agents }) },
    modes: { cardRelease: () => {} },
    data: { setLive: () => {} },
  } as unknown as LayoutPage);
  startPops({ icon: () => document.createElement("i"), closed: popClosed });
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    posted.push([url, JSON.parse(String(init?.body))]);
    return new Response(JSON.stringify({ error: "no such directory" }), { status: 400 });
  });
});
beforeEach(() => {
  act(() => closePop());
  posted.length = 0;
  document.querySelector("button[data-pop]")?.remove();
  button = Object.assign(document.createElement("button"), { textContent: "+" });
  button.dataset.pop = "rail:g";
  document.body.append(button);
});

describe("the rail's box for a new actor", () => {
  it("starts in the dashboard's directory, its group's folders a click away; one picked, the box holds it", () => {
    act(() => openPop("rail:g", button, railNewBox(g, ["h1", "h2"])));
    const box = screen.getByRole("dialog", { name: "New actor in g" });
    const dir = screen.getByRole("textbox", { name: "Working directory" }) as HTMLInputElement;
    expect(dir.value).toBe("~/dash");
    expect(document.activeElement).toBe(dir);
    expect([...box.querySelectorAll(".folders button")].map((b) => b.textContent)).toEqual(["one~/one", "two~/two"]);
    act(() => fireEvent.click(box.querySelector<HTMLElement>(".folders button[title='~/two']")!));
    expect(dir.value).toBe("~/two");
    expect(document.activeElement).toBe(dir);
    expect(screen.getAllByRole("button", { name: /^Harness/ }).map((b) => b.textContent)).toEqual([
      "Harness h1",
      "Harness h2",
    ]);
  });

  it("asks for a directory when none is typed; a start that fails says why in the box, which stays", async () => {
    act(() => openPop("rail:g", button, railNewBox(g, ["h1", "h2"], "h2", "/h/tried", "it failed there")));
    const box = screen.getByRole("dialog", { name: "New actor in g" });
    const dir = screen.getByRole("textbox", { name: "Working directory" }) as HTMLInputElement;
    expect(dir.value).toBe("~/tried");
    expect(box.querySelector(".err")!.textContent).toBe("it failed there");
    act(() => fireEvent.change(dir, { target: { value: "  " } }));
    expect(box.querySelector(".err")!.textContent).toBe("");
    act(() => fireEvent.keyDown(dir, { key: "Enter" }));
    expect(box.querySelector(".err")!.textContent).toBe("Which directory?");
    expect(posted).toEqual([]);
    act(() => fireEvent.change(dir, { target: { value: "~/somewhere" } }));
    await act(async () => fireEvent.keyDown(dir, { key: "Enter" })); // the harness tried, h2
    await waitFor(() => expect(box.querySelector(".err")!.textContent).toBe("no such directory"));
    expect(posted).toEqual([["/api/sessions", { gatherer: "g", cwd: "~/somewhere", harness: "h2" }]]);
    expect(box.isConnected).toBe(true);
  });

  it("for an actor on its own: so headed, the folders any actor works in a click away", () => {
    act(() => openPop("alone", button, railNewBox(g, ["h1"], "h1", "/h/one", "", true)));
    const box = screen.getByRole("dialog", { name: "New actor on its own" });
    expect(box.className).toBe("dw-menu alone-box");
    expect(box.querySelector(".note")!.textContent).toBe("Shares context with no group.");
    expect(box.querySelector(".folders .lbl")!.textContent).toBe("Where actors work");
  });
});
