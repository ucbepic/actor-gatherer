// The Apps page in React (AppsPage.tsx, Dialogs.tsx, store.ts): its sections and search, a row's ⋯ menu, and a dialog
// that asks before it does anything, then says what it did.
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { AppsPage } from "./AppsPage";
import { Dialogs } from "./Dialogs";
import { reload, useCatalog } from "./store";
import type { Catalog } from "./types";

const CATALOG: Catalog = {
  installed: [
    {
      name: "browser",
      label: "Browser",
      description: "a browser you and an agent use together",
      origin: "builtin",
      access: "task",
      tools: ["browser_open", "browser_click"],
      tokens: 8900,
      open: { demo: 3, other: 1 },
      data: { path: "/home/u/.ag/apps/browser", bytes: 7_340_032, there: true },
    },
  ],
  available: [{ name: "pager", label: "Pager", description: "pages you", origin: "index", source: "https://x/pager" }],
  broken: [{ name: "bad", folder: "/home/u/apps/bad", error: "no manifest", origin: "home" }],
};

/** fetch answering each path with `answers[path]`, every request kept. */
function answering(answers: Record<string, unknown>) {
  const calls: { path: string; body: unknown }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (path: string, init?: RequestInit) => {
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      calls.push({ path, body });
      const a = answers[path.split("?")[0]];
      return new Response(JSON.stringify(typeof a === "function" ? a(body) : (a ?? {})), { status: 200 });
    }),
  );
  return calls;
}

beforeAll(() => {
  // what Radix's menus need of a browser that jsdom lacks
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
});
beforeEach(() =>
  useCatalog.setState({ got: null, error: "", note: "", sel: null, q: "", updates: {}, dialog: null, busy: "" }),
);
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

async function shown(changed = vi.fn(async () => {})) {
  useCatalog.setState({ hooks: { open: vi.fn(async () => {}), changed } });
  render(
    <>
      <AppsPage />
      <Dialogs />
    </>,
  );
  await act(() => reload());
}

describe("the Apps page", () => {
  it("lists the apps installed, those to install and those that couldn't load; a search narrows them", async () => {
    answering({ "/api/apps/catalog": CATALOG });
    await shown();
    expect([...document.querySelectorAll(".ap-sec span:first-child")].map((n) => n.textContent)).toEqual([
      "Installed",
      "Available to install",
      "Couldn't load",
    ]);
    const browser = document.querySelector<HTMLElement>('.ap-row[data-app="browser"]')!;
    expect(browser.querySelector(".ap-big")!.textContent).toBe("≈8.9k tokens per agent");
    expect(within(browser).getByText("4 open")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Search apps"), { target: { value: "click" } }); // a tool's name
    expect(document.querySelectorAll(".ap-row")).toHaveLength(1);
    fireEvent.change(screen.getByLabelText("Search apps"), { target: { value: "nothing like it" } });
    expect(screen.getByText("No app matches “nothing like it”.")).toBeTruthy();
  });

  it("uninstalls from a row's menu, asked first, its data deleted when ticked, and says so", async () => {
    const changed = vi.fn(async () => {});
    const calls = answering({ "/api/apps/catalog": CATALOG, "/api/apps/uninstall": {} });
    await shown(changed);
    const more = screen.getByRole("button", { name: "More for Browser" });
    await act(async () => fireEvent.keyDown(more, { key: "Enter" }));
    await act(async () => fireEvent.click(screen.getByRole("menuitem", { name: "Uninstall…" })));
    const dialog = screen.getByRole("dialog", { name: "Uninstall Browser?" });
    expect(dialog.textContent).toContain("Its 4 open windows close (demo 3, other 1).");
    fireEvent.click(within(dialog).getByLabelText(/Also delete its data/));
    await act(async () => fireEvent.click(within(dialog).getByRole("button", { name: "Uninstall" })));
    expect(calls.find((c) => c.path === "/api/apps/uninstall")!.body).toEqual({ name: "browser", data: true });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByRole("status").textContent).toBe("Uninstalled Browser. Its data was deleted.");
    expect(changed).toHaveBeenCalled();
  });

  it("discards an app staged for installing when its dialog is closed", async () => {
    const staged = { ...CATALOG.available[0], id: "s1", origin: "staged", description: "pages you" };
    const calls = answering({ "/api/apps/catalog": CATALOG, "/api/apps/stage": staged, "/api/apps/discard": {} });
    await shown();
    fireEvent.click(screen.getByRole("button", { name: "+ Install from a folder or git URL…" }));
    fireEvent.change(screen.getByLabelText("Folder or git URL"), { target: { value: "/work/pager" } });
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Check" })));
    expect(screen.getByRole("dialog", { name: "Install Pager?" })).toBeTruthy();
    await act(async () => fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(calls.filter((c) => c.path === "/api/apps/discard").map((c) => c.body)).toEqual([{ id: "s1" }]);
  });
});
