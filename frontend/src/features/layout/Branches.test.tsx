// The branch picker (Branches.tsx): its drop-down of a group's sources, read from the server, hung from the button that
// opened it; a source chosen, the popup to start from it; "Add a source…", the popup choosing one; Esc, the focus back.
import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
// (a phone's width, which the layout's modules ask jsdom as they load)
vi.hoisted(() => {
  globalThis.matchMedia ??= (() => ({ matches: false, addEventListener() {} })) as unknown as typeof matchMedia;
});
import { actorOf, gathererOf, homeOf } from "../../core/api/testing";
import { brMenuClose, brMenuOpenFor, openBranchMenu } from "./Branches";
import { setLayoutPage, type LayoutPage } from "./link";
import type { Gatherer, PageState } from "./types";

const g: Gatherer = gathererOf("g", { agents: [actorOf("a", { cwd: "/h/repo", last: 1 })] });
const state: PageState = {
  home: homeOf({ gatherers: [g], harnesses: ["h1"], home_dir: "/h", cwd: "/h/dash" }),
  selected: null,
  starting: null,
  adding: null,
};
const posted: [string, unknown][] = [];
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
  const node = () => document.createElement("i");
  setLayoutPage({
    page: {
      state,
      panes: { here: null, others: [], apps: [], checked: false, top: null },
      SNAPSHOT: null,
      MAX_PANES: 4,
    },
    helpers: {
      ICONS: { x: "M0 0", branch: "M1 1" },
      harnessBadge: node,
      harnessName: (h: string) => `Harness ${h}`,
      runsHere: () => true,
      runnableNames: () => "h1",
    },
    list: { renderAgents: () => {} },
  } as unknown as LayoutPage);
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    if (init?.method === "POST") {
      posted.push([url, JSON.parse(String(init.body))]);
      if (url === "/api/branches") return new Response(JSON.stringify({ error: "no worktree here" }), { status: 400 });
      return new Response(
        JSON.stringify({
          projects: [
            { path: "/h/repo", name: "repo", head: "abc1234", branch: "main" },
            { path: "/h/other", name: "other", head: "def5678", branch: "dev" },
          ],
          suggestions: [],
        }),
      );
    }
    return new Response(
      JSON.stringify({
        projects: [{ path: "/h/repo", name: "repo", github: "o/repo", head: "abc1234", branch: "main" }],
        suggestions: [{ path: "/h/other", name: "other" }],
      }),
    );
  });
});
beforeEach(() => {
  act(() => brMenuClose());
  posted.length = 0;
  document.querySelector("button[data-pop]")?.remove();
  button = Object.assign(document.createElement("button"), { textContent: "+ ⋯" });
  button.dataset.pop = "more:g";
  document.body.append(button);
});

describe("the branch picker", () => {
  it("lists the group's sources once read, the first in focus; a source chosen opens the popup with it", async () => {
    await act(() => openBranchMenu(g, button));
    const menu = screen.getByRole("menu", { name: "New actor on a branch, in g" });
    expect(menu.className).toBe("br-menu");
    expect(button.getAttribute("aria-expanded")).toBe("true");
    expect(menu.querySelector(".hd")!.textContent).toBe("New actor on a branch of");
    const items = screen.getAllByRole("menuitem");
    expect(items.map((n) => n.textContent)).toEqual(["o/repomain~/repo", "+ Add a source…"]);
    await waitFor(() => expect(document.activeElement).toBe(items[0]));
    act(() => fireEvent.click(items[0]));
    expect(brMenuOpenFor("g")).toBe(false);
    expect(button.getAttribute("aria-expanded")).toBe("false");
    const dialog = screen.getByRole("dialog", { name: "New actor on a branch" });
    expect(dialog.querySelector(".br-src .nm")!.textContent).toBe("o/repo");
    expect(dialog.querySelector(".route")!.textContent).toBe(
      "A new branch off main at abc1234, merged into ~/repo on main.",
    );
    const start = screen.getByRole("button", { name: "Harness h1" });
    expect(start).not.toHaveProperty("disabled", true);
    await act(async () => fireEvent.click(start));
    await waitFor(() => expect(dialog.querySelector(".err")!.textContent).toBe("no worktree here"));
    expect(posted).toEqual([["/api/branches", { gatherer: "g", project: "/h/repo", harness: "h1", approve: false }]]);
    act(() => fireEvent.click(screen.getByRole("button", { name: "Cancel" })));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("opens the popup choosing a source from 'Add a source…'; one typed is added and chosen", async () => {
    await act(() => openBranchMenu(g, button));
    act(() => fireEvent.click(screen.getByRole("menuitem", { name: "+ Add a source…" })));
    const dialog = screen.getByRole("dialog", { name: "New actor on a branch" });
    const where = screen.getByRole("textbox", { name: "A folder in a git repository, or a GitHub repository" });
    expect(document.activeElement).toBe(where);
    expect([...dialog.querySelectorAll(".suggest")].map((n) => n.textContent)).toEqual(["+ other~/other"]);
    act(() => fireEvent.change(where, { target: { value: "/h/other" } }));
    await act(async () => fireEvent.keyDown(where, { key: "Enter" }));
    await waitFor(() => expect(dialog.querySelector(".br-src .nm")?.textContent).toBe("other"));
    expect(posted).toEqual([["/api/projects", { gatherer: "g", dirs: ["/h/repo", "/h/dash"], add: "/h/other" }]]);
    act(() => fireEvent.click(screen.getByRole("button", { name: "Close" })));
  });

  it("closes on Esc, the focus back on its button; its button pressed again closes it", async () => {
    await act(() => openBranchMenu(g, button));
    act(() => fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" }));
    expect(screen.queryByRole("menu")).toBeNull();
    expect(document.activeElement).toBe(button);
    await act(() => openBranchMenu(g, button));
    await act(() => openBranchMenu(g, button));
    expect(screen.queryByRole("menu")).toBeNull();
  });
});
